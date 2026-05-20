import type { Category } from '../../../constants/index.ts';
import { GitRefsDatasource } from '../../datasource/git-refs/index.ts';
import { GithubReleasesDatasource } from '../../datasource/github-releases/index.ts';
import { GithubTagsDatasource } from '../../datasource/github-tags/index.ts';

export { extractPackageFile } from './extract.ts';

export const displayName = 'BinaryBuilder';
export const url = 'https://github.com/JuliaPackaging/BinaryBuilder.jl';
export const categories: Category[] = ['julia'];

export const defaultConfig = {
  managerFilePatterns: ['/(^|/)build_tarballs\\.jl$/'],
};

export const supportedDatasources = [
  GithubTagsDatasource.id,
  GithubReleasesDatasource.id,
  GitRefsDatasource.id,
];
