/**
 * The real QuickBooks Desktop transport: the SDK's COM request processor,
 * driven through 32-bit Windows PowerShell.
 *
 * Why this shape:
 *
 *  - `QBXMLRP2.RequestProcessor` is a **32-bit in-process COM server**. A
 *    64-bit Node cannot create it, so something 32-bit has to do the call.
 *    Windows ships a 32-bit PowerShell at
 *    `C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe`, which makes
 *    the install "unzip and run" instead of "install a compiler".
 *  - Request and response travel through **files**, not the command line: a
 *    qbXML document is far past any argument-length limit, and nothing from a
 *    company file is ever concatenated into a command string.
 *  - The temporary files are written inside a private directory created with
 *    mode 0700 and deleted in a `finally`, so invoice data does not linger in
 *    a world-readable temp folder.
 *
 * None of this has been executed against a real QuickBooks in this repository:
 * there is no Windows machine in the toolchain. See docs/QUICKBOOKS-INTEGRATION.md
 * for the exact commands to run on the QuickBooks PC to verify it.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TransportError, type QbxmlTransport } from './QbxmlTransport.js';

/** QBXMLRPConnectionType values used by the SDK samples. */
export const CONNECTION_LOCAL_QBD = 1;
export const CONNECTION_LOCAL_QBD_LAUNCH_UI = 3;
/** QBFileMode: qbFileOpenDoNotCare. */
export const FILE_MODE_DO_NOT_CARE = 2;

/** 32-bit PowerShell. The 64-bit one cannot load the request processor. */
export const POWERSHELL_32 = 'C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe';
export const POWERSHELL_FALLBACK = 'powershell.exe';

export interface ComTransportOptions {
  appName: string;
  appId?: string;
  /** Empty means the company file currently open in QuickBooks. */
  companyFile?: string;
  /** Set true to let QuickBooks start itself (localQBDLaunchUI). */
  launchQuickBooks?: boolean;
  fileMode?: number;
  /** Override the interpreter, e.g. for a portable PowerShell. */
  powerShellPath?: string;
  /** Override the bridge script, e.g. when running from source. */
  scriptPath?: string;
  timeoutMs?: number;
  /** Escape hatch for tests: replaces the actual process spawn. */
  runner?: (command: string, args: string[], timeoutMs: number) => { status: number | null; stderr: string };
}

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Locate `QbxmlRequest.ps1`. It sits next to the bundled CLI when installed,
 * and two directories up from the source file when running from the repository.
 */
export function defaultScriptPath(): string {
  const candidates = [
    join(here, 'QbxmlRequest.ps1'),
    join(here, 'powershell', 'QbxmlRequest.ps1'),
    resolve(here, '..', '..', 'powershell', 'QbxmlRequest.ps1'),
    resolve(here, '..', '..', '..', 'powershell', 'QbxmlRequest.ps1'),
  ];
  return candidates.find((path) => existsSync(path)) ?? (candidates[0] as string);
}

export function defaultPowerShellPath(): string {
  return existsSync(POWERSHELL_32) ? POWERSHELL_32 : POWERSHELL_FALLBACK;
}

function defaultRunner(command: string, args: string[], timeoutMs: number): { status: number | null; stderr: string } {
  const result = spawnSync(command, args, {
    timeout: timeoutMs,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) {
    throw new TransportError(`Could not run "${command}": ${result.error.message}`);
  }
  return { status: result.status, stderr: result.stderr ?? '' };
}

export class ComQbxmlTransport implements QbxmlTransport {
  readonly id = 'com';

  private readonly options: Required<
    Pick<ComTransportOptions, 'appName' | 'appId' | 'companyFile' | 'fileMode' | 'timeoutMs'>
  > & {
    powerShellPath: string;
    scriptPath: string;
    connectionType: number;
    runner: NonNullable<ComTransportOptions['runner']>;
  };

  constructor(options: ComTransportOptions) {
    if (!options.appName || options.appName.trim() === '') {
      throw new TransportError('appName is required: QuickBooks shows it in the authorization prompt.');
    }
    this.options = {
      appName: options.appName,
      appId: options.appId ?? '',
      companyFile: options.companyFile ?? '',
      fileMode: options.fileMode ?? FILE_MODE_DO_NOT_CARE,
      timeoutMs: options.timeoutMs ?? 120_000,
      powerShellPath: options.powerShellPath ?? defaultPowerShellPath(),
      scriptPath: options.scriptPath ?? defaultScriptPath(),
      connectionType: options.launchQuickBooks ? CONNECTION_LOCAL_QBD_LAUNCH_UI : CONNECTION_LOCAL_QBD,
      runner: options.runner ?? defaultRunner,
    };
  }

  describe(): string {
    const file = this.options.companyFile === '' ? 'the open company file' : this.options.companyFile;
    return `QuickBooks Desktop via QBXMLRP2 (${file}), as "${this.options.appName}"`;
  }

  /** Arguments passed to PowerShell. Separated out so a test can assert them. */
  commandLine(requestPath: string, responsePath: string): { command: string; args: string[] } {
    return {
      command: this.options.powerShellPath,
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        this.options.scriptPath,
        '-RequestPath',
        requestPath,
        '-ResponsePath',
        responsePath,
        '-AppName',
        this.options.appName,
        '-AppId',
        this.options.appId,
        '-CompanyFile',
        this.options.companyFile,
        '-ConnectionType',
        String(this.options.connectionType),
        '-FileMode',
        String(this.options.fileMode),
      ],
    };
  }

  async send(requestXml: string): Promise<string> {
    if (process.platform !== 'win32' && this.options.runner === defaultRunner) {
      throw new TransportError(
        `QuickBooks Desktop runs on Windows, and this is ${process.platform}. Capture a response on the QuickBooks PC and replay it with --from-file, or run the helper there.`,
      );
    }
    if (!existsSync(this.options.scriptPath)) {
      throw new TransportError(`The QuickBooks bridge script is missing: ${this.options.scriptPath}`);
    }

    // 0700 on the directory: the request and the response both contain
    // customer and shipment data while they exist.
    const directory = mkdtempSync(join(tmpdir(), 'ace-qbxml-'));
    const requestPath = join(directory, 'request.xml');
    const responsePath = join(directory, 'response.xml');

    try {
      writeFileSync(requestPath, requestXml, { encoding: 'utf8', mode: 0o600 });
      const { command, args } = this.commandLine(requestPath, responsePath);
      const result = this.options.runner(command, args, this.options.timeoutMs);

      if (result.status !== 0) {
        throw new TransportError(
          describeFailure(result.stderr),
          result.stderr.trim(),
        );
      }
      if (!existsSync(responsePath)) {
        throw new TransportError('QuickBooks reported success but wrote no response document.', result.stderr.trim());
      }
      return readFileSync(responsePath, 'utf8');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  async close(): Promise<void> {
    // Each request opens and closes its own session, so there is nothing held
    // between calls. That costs a few hundred milliseconds per request and
    // buys back never leaving a session open against someone's company file.
  }
}

/**
 * Turn the request processor's terse COM errors into something an operator can
 * act on. The messages come from QuickBooks; the advice is ours.
 */
export function describeFailure(stderr: string): string {
  const text = stderr.trim();
  const lower = text.toLowerCase();

  if (lower.includes('80040154') || lower.includes('qbxmlrp2.requestprocessor')) {
    return 'QuickBooks SDK not reachable: QBXMLRP2.RequestProcessor could not be created. Install the QuickBooks Desktop SDK and run the helper under 32-bit PowerShell.';
  }
  if (lower.includes('could not start quickbooks') || lower.includes('0x80040408')) {
    return 'QuickBooks could not be started. Open QuickBooks, sign in to the company file, and try again.';
  }
  if (lower.includes('0x80040401') || lower.includes('no company file')) {
    return 'No company file is open. Open the company file in QuickBooks, or set companyFile in the configuration.';
  }
  if (lower.includes('0x80040402') || lower.includes('unexpected error')) {
    return `QuickBooks returned an unexpected error. ${text}`;
  }
  if (lower.includes('0x80040416') || lower.includes('not allowed') || lower.includes('permission')) {
    return 'QuickBooks denied access to this application. In QuickBooks: Edit > Preferences > Integrated Applications > Company Preferences, then allow the application and re-run.';
  }
  if (lower.includes('0x80040420') || lower.includes('certificate')) {
    return 'The application certificate has not been granted. Sign in to QuickBooks as Admin in single-user mode and answer the authorization prompt, then re-run.';
  }
  if (text === '') {
    return 'The QuickBooks bridge failed without a message. Run it directly in PowerShell to see the error.';
  }
  return `The QuickBooks bridge failed: ${text}`;
}
