{ pkgs, lib, config, inputs, ... }:

{
  packages = [ pkgs.git ];

  languages.javascript = {
    enable = true;
    bun.enable = true;
  };

  enterShell = ''
    echo ""
    echo "── Dev Environment ──"
    echo "  bun: $(bun --version)"
    echo "  git: $(git --version | cut -d' ' -f3)"
    echo ""
  '';
}
