self: { config, lib, pkgs, ... }:
let
  cfg = config.services.vela;
  runtimeConfig = pkgs.writeText "vela-config.json" (builtins.toJSON cfg.settings);
in {
  options.services.vela = {
    enable = lib.mkEnableOption "the Vela car dashboard";
    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.system}.default;
      description = "The built static app.";
    };
    port = lib.mkOption { type = lib.types.port; default = 4590; description = "Loopback port for the static server."; };
    settings = lib.mkOption {
      type = lib.types.attrs;
      default = { };
      description = "Runtime VelaConfig, served as /config.json. See src/contract/config.ts.";
    };
  };

  # Stub: the fleet worker fills in the static server and tsnet node.
  config = lib.mkIf cfg.enable {
    environment.etc."vela/config.json".source = runtimeConfig;
  };
}
