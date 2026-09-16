/**
 * Step 4: Transportation - ACE selectors.
 *
 * SELECTOR STATUS: the whole step was captured on 2026-09-16. It holds exactly
 * three controls, all conditional:
 *
 *   Carrier SCAC/IATA              "MSCU"
 *   Conveyance Name/Carrier Name   "MSC JULIE V. MC732R"   (maxlength 23)
 *   Transportation Reference Number                        (maxlength 30)
 *
 * Two fields this table used to declare - Container Number and Seal Number -
 * do not exist on the step, confirmed in edit mode with Mode of Transport set
 * to "11 - VESSEL, CONTAINERIZED", which is the case where a container panel
 * would appear if there were one. They were never ACE fields: container and
 * seal are carrier booking data, which is what the INTTRA Helper fills. They
 * stay in the canonical model and the spreadsheet for INTTRA and are simply
 * not filed here.
 */

import { bindingPath, byFrameworkName, byIdSuffix, byLabel, capturedLabel, placeholder, verified, type SelectorTable } from './types.js';

export const TRANSPORTATION_SELECTORS: SelectorTable = {
  Carrier: {
    candidates: [
      // Label read off the live screen on 2026-09-16; the DOM id is still
      // uncaptured. Note the field takes a CODE ("MSCU"), not a carrier name.
      placeholder('id', '#carrierScacIata'),
      placeholder('name', "input[name='carrierScacIata']"),
      byFrameworkName('carrierScacIata'),
      byIdSuffix('carrierScacIata'),
      capturedLabel(['Carrier SCAC/IATA'], 'Label wording read off the live AESDirect screen on 2026-09-16; DOM id not yet captured.'),
      byLabel(['Carrier SCAC', 'Carrier Name', 'Carrier', 'SCAC']),
    ],
    devtoolsHint:
      'Transportation tab -> Edit Draft -> inspect the Carrier SCAC/IATA box and copy the full <input> tag, including maxlength. The live value is a 4-letter SCAC ("MSCU" for MSC), so confirm whether it also accepts a 2-3 character IATA airline code.',
  },

  Vessel: {
    candidates: [
      // Captured 2026-09-16:
      // <input name="shipmentInfo.conveyanceName.stringField"
      //        id="shipmentInfo.conveyanceName.stringField" type="text"
      //        maxlength="23" class="form-control">
      bindingPath('shipmentInfo.conveyanceName'),
      capturedLabel(['Conveyance Name/Carrier Name'], 'Label wording read off the live AESDirect screen on 2026-09-16.'),
      byLabel(['Conveyance Name', 'Vessel Name', 'Vessel', 'Carrier/Vessel Name']),
    ],
    devtoolsHint:
      'Transportation tab -> inspect the Conveyance Name/Carrier Name box (maxlength 23). The live value "MSC JULIE V. MC732R" packs vessel name AND voyage number into that one box, so anything the importer builds has to fit 23 characters together.',
  },

  TransportationReferenceNumber: {
    candidates: [
      // Captured 2026-09-16:
      // <input name="refNbrValue" class="form-control" id="refNbrValue"
      //        type="text" maxlength="30" value="">
      // Unlike every other captured control this one is a bare name with no
      // binding path and no .stringField wrapper.
      verified('id', '#refNbrValue', 'Copied from the live AESDirect DOM on 2026-09-16.'),
      verified('name', "input[name='refNbrValue']", 'Copied from the live AESDirect DOM on 2026-09-16.'),
      capturedLabel(['Transportation Reference Number'], 'Label wording read off the live AESDirect screen on 2026-09-16.'),
      byLabel(['Booking Number', 'Booking No', 'Transportation Reference', 'Reference Number']),
    ],
    devtoolsHint:
      'Transportation tab -> inspect the Transportation Reference Number box (id refNbrValue, maxlength 30). For a vessel shipment this is where the booking number goes.',
  },
};
