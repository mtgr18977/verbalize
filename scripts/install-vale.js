const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const VERSION = '3.9.5';
const platform = os.platform();
const arch = os.arch();

let url = '';
let filename = '';
let isZip = false;

if (platform === 'linux' && arch === 'x64') {
  filename = `vale_${VERSION}_Linux_64-bit.tar.gz`;
} else if (platform === 'darwin') {
  if (arch === 'arm64') {
    filename = `vale_${VERSION}_macOS_arm64.tar.gz`;
  } else {
    filename = `vale_${VERSION}_macOS_64-bit.tar.gz`;
  }
} else if (platform === 'win32') {
  filename = `vale_${VERSION}_Windows_64-bit.zip`;
  isZip = true;
}

if (!filename) {
  console.error(`Unsupported platform/architecture: ${platform}/${arch}`);
  process.exit(0); // Exit gracefully to not block npm install
}

url = `https://github.com/errata-ai/vale/releases/download/v${VERSION}/${filename}`;

const targetBinary = platform === 'win32' ? 'vale.exe' : 'vale';
const tmpFile = path.join(os.tmpdir(), filename);

try {
  console.log(`Downloading Vale from ${url}...`);
  execSync(`curl -L "${url}" -o "${tmpFile}"`);

  if (isZip) {
    console.log(`Extracting ${targetBinary} from zip...`);
    // Using tar for zip extraction as it is more robust and available on modern Windows
    execSync(`tar -xf "${tmpFile}" ${targetBinary}`);
  } else {
    console.log(`Extracting ${targetBinary} from tar.gz...`);
    execSync(`tar -xzf "${tmpFile}" ${targetBinary}`);
  }

  if (platform !== 'win32') {
    fs.chmodSync(path.join(process.cwd(), targetBinary), 0o755);
  }

  console.log(`Vale ${VERSION} installed successfully as ${targetBinary}`);
  fs.unlinkSync(tmpFile);
} catch (error) {
  console.error('Failed to install Vale:', error.message);
  process.exit(0); // Exit gracefully
}
