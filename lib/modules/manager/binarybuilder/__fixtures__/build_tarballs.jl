using BinaryBuilder, Pkg

name = "OpenSSL"
version = v"3.2.0"

# Collection of sources required to complete build
sources = [
    ArchiveSource("https://www.openssl.org/source/openssl-3.2.0.tar.gz",
                  "14c826f07c7e433706fb5c69fa9e25dab95684844b4c962a2cf1bf183eb4690e"),
    GitSource("https://github.com/openssl/openssl.git",
              "d6e4056805f54bb1cab1d4d6f2b1bf0bb8204bd9"),
    DirectorySource("./bundled"),
]

script = raw"""
cd \$WORKSPACE/srcdir/openssl-*
./Configure
make -j\${nproc}
make install
"""

platforms = supported_platforms()

products = [
    LibraryProduct("libcrypto", :libcrypto),
    LibraryProduct("libssl", :libssl),
]

dependencies = Dependency[]

build_tarballs(ARGS, name, version, sources, script, platforms, products, dependencies)
