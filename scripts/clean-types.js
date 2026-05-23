import fs from 'fs';
import path from 'path';

function cleanDir(dir) {
  if (!fs.existsSync(dir)) {return;}
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      cleanDir(fullPath);
    } else if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.ts.map')) {
      fs.unlinkSync(fullPath);
    }
  }
}

// Clean root index files if they exist.
if (fs.existsSync('index.d.ts')) {fs.unlinkSync('index.d.ts');}
if (fs.existsSync('index.d.ts.map')) {fs.unlinkSync('index.d.ts.map');}

cleanDir('src');
