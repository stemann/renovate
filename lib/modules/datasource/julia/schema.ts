import { z } from 'zod/v3';

export const JuliaRegistry = z.object({
  packages: z.record(
    z.object({
      name: z.string(),
      path: z.string(),
    }),
  ),
});

export type JuliaRegistry = z.infer<typeof JuliaRegistry>;

export const JuliaPackageVersions = z.record(
  z.object({
    'git-tree-sha1': z.string(),
  }),
);

export type JuliaPackageVersions = z.infer<typeof JuliaPackageVersions>;

export const JuliaPackage = z.object({
  name: z.string(),
  uuid: z.string(),
  repo: z.string(),
});

export type JuliaPackage = z.infer<typeof JuliaPackage>;
