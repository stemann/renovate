using BinaryBuilder

name = "zlib"
version = v"1.3.1"

sources = [
    ArchiveSource("https://github.com/madler/zlib/releases/download/v1.3.1/zlib-1.3.1.tar.gz",
                  "9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23"),
    ArchiveSource("https://github.com/example/foo/archive/refs/tags/v0.4.2.tar.gz",
                  "ab8c1f7c1d3eaa5ab0c5edff62cd8e4be4e6b6c2a5ce9e6f9b8f7a6d5e4c3b2a"),
    FileSource("https://github.com/example/foo/releases/download/v0.4.2/extra-patch.diff",
               "bc7d4e8f9a3b5c1d6e2f0a4b8c9d3e5f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d"),
    FileSource("https://example.com/random/blob.tar",
               "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"),
]

script = raw"""
cd \$WORKSPACE/srcdir
"""

platforms = supported_platforms()

products = [
    LibraryProduct("libz", :libz),
]

dependencies = Dependency[]

build_tarballs(ARGS, name, version, sources, script, platforms, products, dependencies)
