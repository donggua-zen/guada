const { ipcRenderer } = require("electron");

ipcRenderer.on("browser:create-webview", (_event, data) => {
  const webview = document.createElement("webview");
  webview.id = data.windowId;
  webview.setAttribute("partition", data.partition);
  if (data.preloadUrl) webview.setAttribute("preload", data.preloadUrl);
  webview.setAttribute("src", data.url);
  webview.style.width = "1280px";
  webview.style.height = "720px";
  document.body.appendChild(webview);
});

ipcRenderer.on("browser:destroy-webview", (_event, data) => {
  document.getElementById(data.windowId)?.remove();
});
