// Local browser preview of the actual WeChat scene modules; no build dependency.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const port = Number(process.env.OCEAN_PREVIEW_PORT) || 4178;

function bundle() {
  const modules = new Map();
  function visit(file) {
    const id = path.relative(root, file).replace(/\\/g, "/");
    if (modules.has(id)) return id;
    modules.set(id, "");
    let code = fs.readFileSync(file, "utf8");
    code = code.replace(/require\(["'](\.[^"']+)["']\)/g, (_, request) => {
      let dependency = path.resolve(path.dirname(file), request);
      // Match the extensionless local CommonJS imports used by game modules.
      if (!path.extname(dependency)) dependency += ".js";
      if (!dependency.startsWith(root + path.sep)) throw new Error("Module outside game");
      return `require(${JSON.stringify(visit(dependency))})`;
    });
    // Preview-only inspection, excluded from the WeChat package.
    if (id === "src/battle.js") code = code.replace(/return \{\s*update,\s*draw,/, "return { __state: state, __drawEnemies: drawEnemies, __drawPlayer: drawPlayer, update, draw,");
    modules.set(id, code);
    return id;
  }
  const entry = visit(path.join(__dirname, "preview-entry.js"));
  return `(function(){const modules={${[...modules].map(([id, code]) => `${JSON.stringify(id)}:function(require,module,exports){\n${code}\n}`).join(",\n")}};const cache={};function require(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id](require,m,m.exports);return m.exports;}require(${JSON.stringify(entry)});})();`;
}

http.createServer((req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (pathname === "/preview.js") {
      const script = bundle();
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
      res.end(script);
      return;
    }
    const relative = pathname === "/" ? "tools/preview.html" : pathname.slice(1);
    const file = path.resolve(root, relative);
    const asset = relative.startsWith("subpackages/pkg_assets/images/") && file.endsWith(".png");
    if (!file.startsWith(root + path.sep) || (relative !== "tools/preview.html" && !asset)) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { "Content-Type": asset ? "image/png" : "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(fs.readFileSync(file));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(String(error));
  }
}).listen(port, "127.0.0.1", () => console.log(`Ocean preview: http://127.0.0.1:${port}`));
