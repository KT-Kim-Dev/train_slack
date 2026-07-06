/**
 * 서버 TypeScript → JavaScript 번들 (esbuild).
 * @intra-chat/shared 는 번들에 포함, npm 패키지·네이티브 모듈은 external.
 */
import esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function buildServerDist(outDir) {
  await esbuild.build({
    entryPoints: {
      index: path.join(ROOT, "server/src/index.ts"),
      "create-user": path.join(ROOT, "server/scripts/create-user.ts"),
    },
    outdir: outDir,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    packages: "external",
    alias: {
      "@intra-chat/shared": path.join(ROOT, "shared/src/index.ts"),
    },
    logLevel: "info",
  });
}
