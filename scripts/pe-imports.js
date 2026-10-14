/**
 * 极简 PE 导入表解析（Windows 原生模块依赖分析）。
 *
 * 用途：判断 .node / .dll 是否动态链接了 MSVC 运行时（vcruntime / msvcp / concrt 家族）。
 * 干净 Windows 没装 VC++ 运行时时，这类文件 dlopen 报「找不到指定的模块」，必须随包分发。
 * 消费方：
 *   - scripts/rebuild-native-electron.js（构建期收集需要分发的 DLL）
 *   - scripts/verify-asar-layout.js（打包期校验已随包分发）
 */
const fs = require('fs');
const path = require('path');

/** MSVC 可再分发运行时家族；api-ms-win-crt-* / ucrtbase 是 Windows 自带，不在其列 */
const CRT_DLL_PATTERN = /^(vcruntime|msvcp|concrt)/i;

/** PE 文件头里的目标架构编码 */
const PE_MACHINE = {
  x64: 0x8664,
  ia32: 0x14c,
  arm64: 0xaa64,
};

/**
 * 解析 PE 导入表（普通导入 + 延迟导入），返回 { machine, imports }。
 * 非 PE 文件（其它平台的 .node 产物）会抛错，由调用方跳过。
 */
function peImportInfo(file) {
  const buf = fs.readFileSync(file);
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) throw new Error('not PE');
  const peOff = buf.readUInt32LE(0x3c);
  if (buf.toString('ascii', peOff, peOff + 4) !== 'PE\u0000\u0000') throw new Error('not PE');

  const machine = buf.readUInt16LE(peOff + 4);
  const numSections = buf.readUInt16LE(peOff + 6);
  const optSize = buf.readUInt16LE(peOff + 20);
  const optOff = peOff + 24;
  const dataDirOff = optOff + (buf.readUInt16LE(optOff) === 0x20b ? 112 : 96);

  const sections = [];
  const secOff = optOff + optSize;
  for (let i = 0; i < numSections; i++) {
    const o = secOff + i * 40;
    sections.push({
      va: buf.readUInt32LE(o + 12),
      size: Math.max(buf.readUInt32LE(o + 8), buf.readUInt32LE(o + 16)),
      raw: buf.readUInt32LE(o + 20),
    });
  }
  const rvaToOff = (rva) => {
    const s = sections.find((x) => rva >= x.va && rva < x.va + x.size);
    return s ? s.raw + (rva - s.va) : -1;
  };
  const cstr = (off) => {
    if (off < 0 || off >= buf.length) return '';
    let end = off;
    while (end < buf.length && buf[end] !== 0) end++;
    return buf.toString('ascii', off, end);
  };

  const imports = [];
  // 1 = 导入表（描述符 20B，名字在 +12）；13 = 延迟导入表（描述符 32B，名字在 +4）
  for (const [dirIndex, stride, nameOffset] of [
    [1, 20, 12],
    [13, 32, 4],
  ]) {
    const rva = buf.readUInt32LE(dataDirOff + dirIndex * 8);
    if (!rva) continue;
    let off = rvaToOff(rva);
    while (off > 0 && off + stride <= buf.length) {
      const nameRva = buf.readUInt32LE(off + nameOffset);
      const name = nameRva ? cstr(rvaToOff(nameRva)) : '';
      if (!name && nameRva === 0) break;
      if (name) imports.push(name);
      off += stride;
    }
  }
  return { machine, imports };
}

/** 导入表里属于 MSVC 可再分发运行时家族的 DLL 名（小写、去重、稳定排序） */
function crtImports(info) {
  return [...new Set(info.imports.filter((n) => CRT_DLL_PATTERN.test(n)).map((n) => n.toLowerCase()))].sort();
}

/** 递归收集目录下的原生二进制（.node / .dll） */
function collectNativeBinaries(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectNativeBinaries(full, out);
    else if (/\.(node|dll)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

module.exports = { peImportInfo, crtImports, collectNativeBinaries, CRT_DLL_PATTERN, PE_MACHINE };
