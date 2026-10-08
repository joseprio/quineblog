// Must run before prism-core: stops Prism from highlighting the page by itself on load.
(window as unknown as { Prism: object }).Prism = { manual: true, disableWorkerMessageHandler: true };
