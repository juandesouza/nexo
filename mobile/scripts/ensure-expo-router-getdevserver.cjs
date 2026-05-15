/**
 * Re-applies getDevServer CJS/ESM interop fixes after `pnpm install`.
 *
 * RN 0.81+ ships `getDevServer` as `export default function`; Metro/CJS interop
 * often yields `{ default: fn }`. Any code that treats `require()` or a broken
 * default re-export as a callable crashes with "getDevServer is not a function".
 */
const fs = require("fs");
const path = require("path");

const mobileRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(mobileRoot, "..");

function resolvePkgDir(name) {
  for (const base of [mobileRoot, repoRoot]) {
    try {
      return path.dirname(require.resolve(`${name}/package.json`, { paths: [base] }));
    } catch (_) {
      /* try next */
    }
  }
  return null;
}

/** pnpm keeps duplicates under node_modules/.pnpm — patch every copy used by the graph. */
function listPnpmPackageRoots(pkgFolderName, startsWith) {
  const pnpmDir = path.join(repoRoot, "node_modules", ".pnpm");
  if (!fs.existsSync(pnpmDir)) {
    return [];
  }
  const out = [];
  for (const ent of fs.readdirSync(pnpmDir, { withFileTypes: true })) {
    if (!ent.isDirectory() || !ent.name.startsWith(startsWith)) {
      continue;
    }
    const root = path.join(pnpmDir, ent.name, "node_modules", ...pkgFolderName.split("/"));
    if (fs.existsSync(path.join(root, "package.json"))) {
      out.push(root);
    }
  }
  return out;
}

const wrapMarker = "nexo-wrap-rn-getDevServer";

const metroGetDevServerNativeFixed = `import rnMod from 'react-native/Libraries/Core/Devtools/getDevServer';

// ${wrapMarker}
const getDevServer = () => {
  const fn =
    typeof rnMod === "function"
      ? rnMod
      : typeof rnMod?.default === "function"
        ? rnMod.default
        : null;
  if (fn != null) {
    return fn();
  }
  return {
    url: "http://127.0.0.1:8081/",
    fullBundleUrl: "",
    bundleLoadedFromServer: true,
  };
};

export default getDevServer;
`;

const expoGetDevServerNativeFixed = `// @ts-expect-error
import rnMod from 'react-native/Libraries/Core/Devtools/getDevServer';

// ${wrapMarker}
const getDevServer = () => {
  const fn =
    typeof rnMod === "function"
      ? rnMod
      : typeof rnMod?.default === "function"
        ? rnMod.default
        : null;
  if (fn != null) {
    return fn();
  }
  return {
    url: "http://127.0.0.1:8081/",
    fullBundleUrl: "",
    bundleLoadedFromServer: true,
  };
};

export default getDevServer;
`;

const metroGetDevServerNativeNeedle = `import getDevServer from 'react-native/Libraries/Core/Devtools/getDevServer';

export default getDevServer;
`;

const expoGetDevServerNativeNeedle = `// @ts-expect-error
import getDevServer from 'react-native/Libraries/Core/Devtools/getDevServer';

export default getDevServer;
`;

function patchMetroRuntimeGetDevServerNative() {
  const roots = new Set([
    ...listPnpmPackageRoots("@expo/metro-runtime", "@expo+metro-runtime@"),
    resolvePkgDir("@expo/metro-runtime")
  ].filter(Boolean));

  let any = false;
  for (const pkgDir of roots) {
    const target = path.join(pkgDir, "src", "getDevServer.native.ts");
    if (!fs.existsSync(target)) {
      continue;
    }
    try {
      const cur = fs.readFileSync(target, "utf8");
      if (cur.includes(wrapMarker)) {
        continue;
      }
      if (cur.trim() === metroGetDevServerNativeNeedle.trim()) {
        fs.writeFileSync(target, metroGetDevServerNativeFixed, "utf8");
        any = true;
      }
    } catch (e) {
      console.warn("[nexo mobile] metro-runtime getDevServer.native patch skipped:", (e && e.message) || e);
    }
  }
  return any;
}

function patchExpoAsyncRequireGetDevServerNative() {
  const roots = new Set(listPnpmPackageRoots("expo", "expo@54."));
  let any = false;
  for (const pkgDir of roots) {
    const target = path.join(pkgDir, "src", "async-require", "getDevServer.native.ts");
    if (!fs.existsSync(target)) {
      continue;
    }
    try {
      const cur = fs.readFileSync(target, "utf8");
      if (cur.includes(wrapMarker)) {
        continue;
      }
      if (cur.trim() === expoGetDevServerNativeNeedle.trim()) {
        fs.writeFileSync(target, expoGetDevServerNativeFixed, "utf8");
        any = true;
      }
    } catch (e) {
      console.warn("[nexo mobile] expo getDevServer.native patch skipped:", (e && e.message) || e);
    }
  }
  return any;
}

const routerTargets = (() => {
  const fromResolve = resolvePkgDir("expo-router");
  const roots = new Set(listPnpmPackageRoots("expo-router", "expo-router@"));
  if (fromResolve) {
    roots.add(fromResolve);
  }
  return [...roots].map((r) =>
    path.join(r, "build", "getDevServer", "index.native.js")
  );
})();

const routerFixed = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDevServer = void 0;
const mod = require("react-native/Libraries/Core/Devtools/getDevServer");
const resolved =
  typeof mod === "function" ? mod : typeof mod?.default === "function" ? mod.default : null;
exports.getDevServer =
  typeof resolved === "function"
    ? resolved
    : function getDevServerFallback() {
        return {
          url: "http://127.0.0.1:8081/",
          fullBundleUrl: "",
          bundleLoadedFromServer: true
        };
      };
//# sourceMappingURL=index.native.js.map
`;

const routerMarker = "getDevServerFallback";

function patchExpoRouter() {
  let any = false;
  for (const routerTarget of routerTargets) {
    try {
      if (!fs.existsSync(routerTarget)) {
        continue;
      }
      const cur = fs.readFileSync(routerTarget, "utf8");
      if (cur.includes(routerMarker)) {
        continue;
      }
      fs.writeFileSync(routerTarget, routerFixed, "utf8");
      any = true;
    } catch (e) {
      console.warn("[nexo mobile] expo-router getDevServer patch skipped:", (e && e.message) || e);
    }
  }
  return any;
}

const metroSocketMarker = "nexo-getDevServerInterop";

function patchMetroRuntimeMessageSocket() {
  const roots = new Set([
    ...listPnpmPackageRoots("@expo/metro-runtime", "@expo+metro-runtime@"),
    resolvePkgDir("@expo/metro-runtime")
  ].filter(Boolean));

  let any = false;
  for (const pkgDir of roots) {
    const target = path.join(pkgDir, "src", "messageSocket.native.ts");
    if (!fs.existsSync(target)) {
      continue;
    }
    try {
      const cur = fs.readFileSync(target, "utf8");
      if (cur.includes(metroSocketMarker)) {
        continue;
      }
      const needle = `  const getDevServer = require('react-native/Libraries/Core/Devtools/getDevServer');
  const devServer = getDevServer();`;
      if (!cur.includes(needle)) {
        continue;
      }
      const replacement = `  // ${metroSocketMarker}
  const _gdsMod = require('react-native/Libraries/Core/Devtools/getDevServer');
  const getDevServer =
    typeof _gdsMod === 'function'
      ? _gdsMod
      : typeof _gdsMod?.default === 'function'
        ? _gdsMod.default
        : () => ({
            url: 'http://127.0.0.1:8081/',
            fullBundleUrl: '',
            bundleLoadedFromServer: true,
          });
  const devServer = getDevServer();`;
      fs.writeFileSync(target, cur.replace(needle, replacement), "utf8");
      any = true;
    } catch (e) {
      console.warn("[nexo mobile] metro-runtime messageSocket patch skipped:", (e && e.message) || e);
    }
  }
  return any;
}

const a = patchExpoRouter();
const b = patchMetroRuntimeMessageSocket();
const c = patchMetroRuntimeGetDevServerNative();
const d = patchExpoAsyncRequireGetDevServerNative();
if (a || b || c || d) {
  const parts = [];
  if (a) parts.push("expo-router getDevServer");
  if (b) parts.push("@expo/metro-runtime messageSocket");
  if (c) parts.push("@expo/metro-runtime getDevServer.native");
  if (d) parts.push("expo async-require getDevServer.native");
  console.log("[nexo mobile] Patched for Expo Go / RN getDevServer interop:", parts.join(", "));
}
