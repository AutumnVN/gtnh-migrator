const { copyFileSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } = require('fs');
const { dirname, join } = require('path');
const { createInterface } = require('readline/promises');

const INSTANCES = join(process.env.APPDATA, 'PrismLauncher', 'instances');

const say = (...m) => console.log(...m);
const step = (m) => console.log(`\n${m}`);

const COPY_DIRS = [
    'cachedImages',
    'ESM',
    'journeymap',
    'resourcepacks',
    'saves',
    'schematics',
    'screenshots',
    'shaderpacks',
    'serverutilities',
    'TCNodeTracker',
    'visualprospecting',
];
const COPY_PATHS = [
    'config/InGameInfoXML',
    'config/InGameInfoXML.cfg',
    'config/freecam-gtnh.cfg',
    'config/lootgames/games',
    'config/shaders.properties',
    'config/vendingmachine/favourites',
    'BotaniaVars.dat',
    'localconfig.cfg',
    'options.txt',
    'optionsnf.txt',
    'servers.dat',
];
const DISABLE_MODS = [/^darkerer.*\.jar$/i, /^simpleskinbackport.*\.jar$/i, /^journeymap.*fairplay.*\.jar$/i];
const ADD_MODS = [/^journeymap-forge.*\.jar$/i, /^skinport.*\.jar$/i];
const CONFIG = [
    ['config/GregTech/Pollution.cfg', 'pollution', 'Activate Pollution', false],
    ['config/GregTech/WorldGeneration.cfg', 'worldgen/general', 'generateUndergroundDirtGen', false],
    ['config/GregTech/WorldGeneration.cfg', 'worldgen/general', 'generateUndergroundGravelGen', false],
    ['config/forestry/common.cfg', 'mobs', 'disable.butterfly', true],
    ['config/EnderStorage.cfg', '', 'item.storage-size', 2],
    ['config/RWG.cfg', 'settings', 'Generate Mineshafts', false],
    ['config/RWG.cfg', 'settings', 'Generate Caves', false],
    ['config/RWG.cfg', 'settings', 'Generate Underground Lakes', false],
    ['config/mcpatcherforge.cfg', 'better_skies', 'enabled', true],
    ['config/RandomThings.cfg', 'settings', 'BloodMoonChance', 0],
    ['config/bogosorter.cfg', 'general/dropoff', 'dropoffRadius', 16],
    ['config/bogosorter.cfg', 'general/dropoff', 'dropoffChatMessage', false],
    ['config/StorageDrawers.cfg', 'blocks/controller', 'maxDrawers', 500],
    ['config/StorageDrawers.cfg', 'blocks/controller', 'range', 16],
    ['config/railcraft/railcraft.cfg', 'worldgen/generate', 'abyssal', false],
    ['config/railcraft/railcraft.cfg', 'worldgen/generate', 'quarried', false],
    ['config/freecam-gtnh.cfg', 'general', 'collisionMode', 'NONE'],
    ['config/freecam-gtnh.cfg', 'misc', 'disableSubmersionFog', true],
    ['config/freecam-gtnh.cfg', 'movement', 'movementMode', 'STATIC'],
    ['config/betterquesting.cfg', 'general', 'Scroll multiplier', '3.0'],
    ['config/endercore/endercore.cfg', 'general', 'betterAchievements', false],
    ['config/adventurebackpack.cfg', 'graphics/status', 'Enable Overlay', false],
    ['config/Waila.cfg', 'general', 'waila.cfg.posx', 5000],
    ['config/Waila.cfg', 'general', 'waila.cfg.posy', 100],
];

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const mkdir = (p) => mkdirSync(p, { recursive: true });

function copyFile(from, to) {
    mkdir(dirname(to));
    copyFileSync(from, to);
}

function copyDir(from, to) {
    mkdir(to);
    for (const e of readdirSync(from, { withFileTypes: true })) {
        const a = join(from, e.name);
        const b = join(to, e.name);
        if (e.isDirectory()) copyDir(a, b);
        else copyFile(a, b);
    }
}

const QUOTE = (s) => (s.startsWith('"') && s.endsWith('"') && s.length > 1 ? s.slice(1, -1) : s);
const pad = (line) => (line.match(/^\s*/) || [''])[0];

function valueType(value) {
    if (value === true || value === false) return 'B';
    if (/^-?\d+$/.test(value)) return 'I';
    if (/^-?\d*\.?\d+([eE][-+]?\d+)?$/.test(value)) return 'D';
    return 'S';
}
const entry = (type, key, value) =>
    `${type ? `${type}:` : ''}${/[\s"'=<>]/.test(key) ? `"${key}"` : key}=${value}`;
const siblingType = (list) => {
    const tally = {};
    const items = list.filter(Boolean);
    for (const x of items) tally[x] = (tally[x] || 0) + 1;
    const top = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
    return top && tally[top] * 2 > items.length ? top : null;
};

function outline(text) {
    const open = [];
    const out = [];
    text.split(/\r?\n/).forEach((line, i) => {
        const t = line.trim();
        if (!t || t.startsWith('#') || t.startsWith('//')) return;
        if (t === '}' || t === '>' || t === ']') {
            open.pop();
            out.push({ i, close: true });
            return;
        }
        const list = t.match(/^[BSIDFL]:?"?([^"=<]+?)"?\s*<\s*$/);
        if (list) { open.push(list[1].trim()); out.push({ i }); return; }
        const block = t.match(/^(.+?)\s*\{\s*$/);
        if (block) { open.push(block[1].trim()); out.push({ i, block: [...open].join('/') }); return; }
        const kv = t.match(/^(?:([BSIDFL]):)?(.*?)=(.*)$/);
        if (kv) out.push({ i, key: QUOTE(kv[2].trim()), raw: kv[2].trim(), type: kv[1], path: [...open, QUOTE(kv[2].trim())].join('/') });
    });
    return out;
}

function setConfigValue(text, block, key, value, typed) {
    const lines = text.split(/\r?\n/);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const full = block ? `${block}/${key}` : key;
    const found = outline(text);

    const hit = found.find((o) => o.path === full);
    if (hit) {
        lines[hit.i] = `${pad(lines[hit.i])}${hit.type ? `${hit.type}:` : ''}${hit.raw}=${value}`;
        return lines.join(eol);
    }

    const parts = block ? block.split('/') : [];
    for (let d = parts.length; d > 0; d--) {
        const open = found.find((o) => o.block === parts.slice(0, d).join('/'));
        if (!open) continue;
        let depth = 0;
        for (const o of found) {
            if (o.i <= open.i) continue;
            if (o.close) {
                if (depth === 0) {
                    const inside = found.filter((x) => x.i > open.i && x.i < o.i && x.type);
                    const type = typed ? siblingType(inside.map((x) => x.type)) || valueType(value) : null;
                    lines.splice(o.i, 0, `${pad(lines[open.i])}    ${entry(type, key, value)}`);
                    return lines.join(eol);
                }
                depth--;
            } else if (!o.key) depth++;
        }
        break;
    }

    let out = lines;
    while (out.length && out[out.length - 1].trim() === '') out.pop();
    let indent = '';
    for (const p of parts) {
        out.push(`${indent}${p} {`);
        indent += '    ';
    }
    out.push(`${indent}${entry(typed ? valueType(value) : null, key, value)}`);
    for (let i = parts.length; i > 0; i--) {
        indent = indent.slice(0, -4);
        out.push(`${indent}}`);
    }
    return `${out.join(eol)}${eol}`;
}

function writeConfig(root, file, block, key, value) {
    const full = join(root, file);
    if (!isFile(full)) throw new Error(`missing config file: ${file}`);
    const text = readFileSync(full, 'utf8');
    writeFileSync(full, setConfigValue(text, block, key, value, outline(text).some((o) => o.type)));
}

const GTNH_NAME = /(gregtech|gt)[\s_-]*new[\s_-]*horizons/i;
const GTNH_SHORT = /gtnh/i;

function detect() {
    if (!isDir(INSTANCES)) throw new Error(`instances folder not found: ${INSTANCES}`);
    return readdirSync(INSTANCES, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter((n) => isDir(join(INSTANCES, n, '.minecraft')) && (GTNH_NAME.test(n) || GTNH_SHORT.test(n)));
}

async function pick(rl, list, question) {
    list.forEach((n, i) => say(`  ${i + 1}) ${n}`));
    for (; ;) {
        const n = Number(await rl.question(`${question}: `));
        if (n >= 1 && n <= list.length) return list[n - 1];
        say(`  enter a number 1-${list.length}`);
    }
}

async function main() {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    say(`Instances folder: ${INSTANCES}`);
    const found = detect();
    if (found.length < 2) throw new Error(`need at least 2 GTNH instances, found ${found.length}`);

    const fromName = await pick(rl, found, 'Old instance');
    const toName = await pick(rl, found.filter((n) => n !== fromName), 'New instance');
    const oldMc = join(INSTANCES, fromName, '.minecraft');
    const newMc = join(INSTANCES, toName, '.minecraft');

    step(`From: ${fromName}\nTo:   ${toName}\nMatching files in "${toName}" will be overwritten.`);
    if ((await rl.question('Continue? (y/N) ')).trim().toLowerCase() !== 'y') {
        rl.close();
        say('Cancelled.');
        return;
    }
    rl.close();

    step('Copying');
    for (const p of [...COPY_DIRS, ...COPY_PATHS]) {
        const a = join(oldMc, p);
        if (isDir(a)) copyDir(a, join(newMc, p));
        else if (isFile(a)) copyFile(a, join(newMc, p));
        else { say(`  skip ${p} (not in old instance)`); continue; }
        say(`  copied ${p}`);
    }

    step('Config values');
    for (const [file, block, key, value] of CONFIG) {
        writeConfig(newMc, file, block, key, value);
        say(`  ${file}  ${block ? `${block}/` : ''}${key} = ${value}`);
    }

    step('Mods');
    const mods = join(newMc, 'mods');
    mkdir(mods);
    const installed = readdirSync(mods);
    for (const name of installed) {
        if (!DISABLE_MODS.some((r) => r.test(name))) continue;
        renameSync(join(mods, name), join(mods, `${name}.disabled`));
        say(`  disabled ${name}`);
    }
    const oldMods = join(oldMc, 'mods');
    for (const rule of ADD_MODS) {
        const there = installed.find((n) => rule.test(n));
        if (there) { say(`  already installed: ${there}`); continue; }
        const src = isDir(oldMods) ? readdirSync(oldMods).find((n) => rule.test(n)) : null;
        if (!src) { say(`  not found in old instance, add it by hand`); continue; }
        copyFile(join(oldMods, src), join(mods, src));
        say(`  added ${src}`);
    }

    step('Done.');
}

main().catch((e) => { console.error(`\nError: ${e.message}`); process.exit(1); });
