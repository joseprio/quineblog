// Entry point, bundled into the single HTML file by build.mjs.
import { exportData, exportHTML, importData, rebuild } from './content';
import { routeHooks, startRouter } from './views';
import { startAuthor } from './author';
import { highlight, loadGrammars } from './code';

// Exposed for the build step and for scripting from the console.
Object.assign(window, { quine: { exportHTML, exportData, importData } });

loadGrammars();
routeHooks.push(highlight);
rebuild();
startAuthor();
startRouter();
