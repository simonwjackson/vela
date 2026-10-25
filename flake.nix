{
  description = "Vela: a calm car dashboard PWA";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      devShells = forAll (pkgs: {
        default = pkgs.mkShell { packages = [ pkgs.nodejs_22 pkgs.just ]; };
      });

      # The built static app. The hash is filled in once the dependency set settles.
      packages = forAll (pkgs: {
        default = pkgs.buildNpmPackage {
          pname = "vela";
          version = "0.0.0";
          src = self;
          npmDepsHash = pkgs.lib.fakeHash;
          installPhase = "cp -r dist $out";
        };
      });

      # Serves the static app and /config.json. Every personal value is an option set by the
      # host configuration, never a constant in this repository (ADR 0005, ADR 0006).
      nixosModules.default = import ./nix/module.nix self;
    };
}
