// ============================================================================
// withFmtXcode16Fix — correção de build p/ Xcode 16.3+ com React Native 0.76
// ----------------------------------------------------------------------------
// O pod "fmt" 9.x (dependência do React Native/folly) não compila em C++20
// com o clang novo (erros de consteval em format-inl.h). Compilar SÓ esse pod
// em C++17 resolve. Este plugin injeta o override no post_install do Podfile,
// então o conserto sobrevive a `expo prebuild --clean`.
// ============================================================================
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SNIPPET = `
    # Xcode 16.3+/clang17: patch no fmt do React Native — neutraliza o
    # consteval direto no fonte (base.h); imune a overrides de build setting
    fmt_base = File.join(installer.sandbox.root, 'fmt/include/fmt/base.h')
    if File.exist?(fmt_base)
      src = File.read(fmt_base)
      unless src.include?('PATINETE_FMT_PATCH')
        File.chmod(0644, fmt_base)
        src.sub!("#define FMT_BASE_H_",
          "#define FMT_BASE_H_\\n" \\
          "// PATINETE_FMT_PATCH: clang17 — consteval neutralizado\\n" \\
          "#define FMT_USE_NONTYPE_TEMPLATE_ARGS 0")
        src.sub!("#  define FMT_CONSTEVAL consteval",
                 "#  define FMT_CONSTEVAL  /* PATINETE_FMT_PATCH */")
        File.write(fmt_base, src)
      end
    end`;

module.exports = function withFmtXcode16Fix(config) {
  return withDangerousMod(config, ['ios', (cfg) => {
    const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
    if (fs.existsSync(podfile)) {
      let s = fs.readFileSync(podfile, 'utf8');
      if (!s.includes("t.name == 'fmt'")) {
        s = s.replace(/post_install do \|installer\|/,
                      'post_install do |installer|' + SNIPPET);
        fs.writeFileSync(podfile, s);
      }
    }
    return cfg;
  }]);
};
