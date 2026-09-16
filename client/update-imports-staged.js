const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SRC = path.resolve(__dirname, 'src');

function getStagedRenames() {
  const output = execSync('git diff --cached --name-status -M', {
    cwd: __dirname,
    encoding: 'utf8',
  }).trim();

  const renames = new Map();
  if (!output) return renames;

  const lines = output.split('\n');
  for (const line of lines) {
    // Format: R100    old/path    new/path
    const match = line.match(/^R\d+\s+(.+?)\s+(.+)$/);
    if (match) {
      let oldPath = match[1];
      let newPath = match[2];
      if (oldPath.startsWith('src/')) oldPath = oldPath.slice(4);
      if (newPath.startsWith('src/')) newPath = newPath.slice(4);
      const oldAbs = path.resolve(SRC, oldPath);
      const newAbs = path.resolve(SRC, newPath);
      renames.set(oldAbs, newAbs);
    }
  }
  return renames;
}

function buildDirMap(renames) {
  const dirMap = new Map();
  for (const [oldAbs, newAbs] of renames.entries()) {
    let oldDir = path.dirname(oldAbs);
    let newDir = path.dirname(newAbs);
    while (oldDir !== SRC) {
      const oldRel = path.relative(SRC, oldDir);
      const newRel = path.relative(SRC, newDir);
      if (!dirMap.has(oldRel)) {
        dirMap.set(oldRel, newRel);
      }
      oldDir = path.dirname(oldDir);
      newDir = path.dirname(newDir);
    }
  }
  return dirMap;
}

function getAllTsFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      getAllTsFiles(fullPath, files);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function getRelativePath(from, to) {
  const rel = path.relative(path.dirname(from), to);
  return rel.replace(/\\/g, '/');
}

// Get old path for a new path from the rename map
function getOldPath(newPath, renames) {
  for (const [oldPath, newPathEntry] of renames.entries()) {
    if (newPathEntry === newPath) return oldPath;
  }
  return null;
}

// Resolve an old import path using ONLY the rename map
function resolveOldImport(importPath, fromOldFile, renames, dirMap) {
  if (!importPath.startsWith('.')) return null;

  const fromOldDir = path.dirname(fromOldFile);
  let resolved = path.resolve(fromOldDir, importPath);

  // Try with extensions for files
  const extensions = ['', '.ts', '.tsx'];
  for (const ext of extensions) {
    const candidate = resolved + ext;
    if (renames.has(candidate)) {
      return renames.get(candidate);
    }
  }

  // Try index files in directory
  const indexFiles = ['index.ts', 'index.tsx'];
  for (const indexFile of indexFiles) {
    const indexPath = path.join(resolved, indexFile);
    if (renames.has(indexPath)) {
      return renames.get(indexPath);
    }
  }

  // Check if a parent directory was renamed
  let checkDir = resolved;
  while (checkDir !== SRC) {
    const checkRel = path.relative(SRC, checkDir);
    if (dirMap.has(checkRel)) {
      const newDir = path.resolve(SRC, dirMap.get(checkRel));
      if (resolved !== checkDir) {
        const fileName = path.basename(resolved);
        return path.join(newDir, fileName);
      }
      return newDir;
    }
    checkDir = path.dirname(checkDir);
  }

  return null;
}

function updateFile(filePath, renames, dirMap) {
  const oldPath = getOldPath(filePath, renames);
  if (!oldPath) return false;

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let updated = false;
  const newLines = [];

  for (const line of lines) {
    const importMatch = line.match(/^(\s*import\s+.*?\s+from\s+['"])([^'"]+)(['"];?.*)$/);
    if (importMatch) {
      const prefix = importMatch[1];
      const importPath = importMatch[2];
      const suffix = importMatch[3];

      if (importPath.startsWith('.')) {
        const newTarget = resolveOldImport(importPath, oldPath, renames, dirMap);
        if (newTarget) {
          let newRelPath = getRelativePath(filePath, newTarget);
          newRelPath = newRelPath.replace(/\.(ts|tsx)$/, '');
          newLines.push(`${prefix}${newRelPath}${suffix}`);
          updated = true;
          continue;
        }
      }
    }
    newLines.push(line);
  }

  if (updated) {
    fs.writeFileSync(filePath, newLines.join('\n'));
  }
  return updated;
}

function main() {
  const renames = getStagedRenames();
  console.log(`Found ${renames.size} renamed files`);

  const dirMap = buildDirMap(renames);

  const files = getAllTsFiles(SRC);
  console.log(`Found ${files.length} TypeScript files`);

  let updatedCount = 0;
  let skippedCount = 0;
  for (const file of files) {
    const oldPath = getOldPath(file, renames);
    if (!oldPath) {
      skippedCount++;
      continue;
    }
    if (updateFile(file, renames, dirMap)) {
      updatedCount++;
    }
  }

  console.log(`Updated imports in ${updatedCount} files`);
  console.log(`Skipped ${skippedCount} files (not renamed)`);
}

main();
