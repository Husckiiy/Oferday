import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const startupDir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const vbsScript = path.resolve(process.cwd(), 'start-silent.vbs');
const shortcutPath = path.join(startupDir, 'BotPromocoes247.lnk');

const vbsCreator = `
Set oWS = WScript.CreateObject("WScript.Shell")
sLinkFile = "${shortcutPath.replace(/\\/g, '\\\\')}"
Set oLink = oWS.CreateShortcut(sLinkFile)
oLink.TargetPath = "wscript.exe"
oLink.Arguments = """${vbsScript.replace(/\\/g, '\\\\')}"""
oLink.WorkingDirectory = "${process.cwd().replace(/\\/g, '\\\\')}"
oLink.Save
`;

const tempVbs = path.join(process.cwd(), 'temp_create_shortcut.vbs');
fs.writeFileSync(tempVbs, vbsCreator, 'utf-8');

try {
  execSync(`cscript //nologo "${tempVbs}"`);
  console.log('✅ Atalho criado com sucesso em:', shortcutPath);
  console.log('Existe:', fs.existsSync(shortcutPath));
} finally {
  if (fs.existsSync(tempVbs)) fs.unlinkSync(tempVbs);
}
