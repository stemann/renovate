using BinaryBuilder

include("../common.jl")

name = "GenericPackage"
version = versions_dict[ARGS[1]]

# The sources list is constructed by `common.jl` and the per-version
# table loaded above. Static regex extraction cannot follow this
# indirection, so this recipe should yield zero extracted dependencies.
sources = build_sources(name, version)

script = raw"""
cd \$WORKSPACE/srcdir
"""

platforms = supported_platforms()
products = Product[]
dependencies = Dependency[]

build_tarballs(ARGS, name, version, sources, script, platforms, products, dependencies)
