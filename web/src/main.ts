/** Entry point of the hosted dashboard. Everything happens in this page. */

import { byId } from '../../src/ui/dom.js';
import { mountDashboard } from './app.js';

mountDashboard(byId('root'));
