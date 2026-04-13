import json from '@rollup/plugin-json';
import rollupBase from '../../rollup.config.js';
import packageJson from './package.json';

export default (args) => {
  const baseConfig = rollupBase(args);

  return {
    ...baseConfig,
    plugins: [...baseConfig.plugins, json()],
    output: [
      {
        file: packageJson.main,
        format: 'cjs',
        sourcemap: true
      },
      {
        file: packageJson.module,
        format: 'esm',
        sourcemap: true
      }
    ]
  };
};
