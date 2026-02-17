import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "PictoChatter Desktop",
    icon: join(__dirname, 'client/public/favicon.ico'), // Assure-toi que l'icône existe
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  // En développement, on peut charger localhost:5173
  // En production, on chargera l'URL hébergée ou le fichier local
  const startUrl = process.env.ELECTRON_START_URL || 'http://localhost:5173';
  win.loadURL(startUrl);

  // Supprimer la barre de menu
  win.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
