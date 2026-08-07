const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';

  return {
    entry: './src/index.js',
    output: {
      // Builds into server/public/ — the Express server (server/index.js)
      // serves this folder as static files. The app is now opened over
      // http://127.0.0.1:<port>, not file://, so none of the old
      // wasm-inlining / no-devServer / relative-publicPath workarounds are
      // needed anymore.
      path: path.resolve(__dirname, 'server', 'public'),
      filename: 'pip.bundle.js',
      publicPath: '/'
    },
    optimization: {
      splitChunks: false,
      runtimeChunk: false,
      // TerserPlugin's default `test` matches every emitted .js/.mjs asset,
      // including pdf.worker.mjs (pulled in via `new URL(..., import.meta.url)`
      // in fileViewerModal.js), not just the app's own compiled modules. Both
      // pdfjs-dist's own pre-minified build AND webpack re-minifying the
      // unminified one hit the same Terser bug — a real SyntaxError at
      // runtime ("Private field must be declared in an enclosing class"),
      // reproduced by dynamically importing the emitted file directly. The
      // worker has to ship un-minified; excluding it is the only lever here.
      minimizer: [new TerserPlugin({ exclude: /pdf\.worker/ })]
    },
    module: {
      rules: [
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, 'css-loader']
        },
        {
          test: /\.(woff2?|ttf|eot)$/,
          type: 'asset/inline'
        },
        {
          // Pulled in via `new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url)`
          // in fileViewerModal.js. Named explicitly (rather than the default
          // content-hash-only asset filename) so the minimizer's `exclude`
          // below can actually match it by name.
          test: /pdf\.worker\.mjs$/,
          type: 'asset/resource',
          generator: { filename: 'pdf.worker.[contenthash][ext]' }
        }
      ]
    },
    plugins: [
      new MiniCssExtractPlugin({ filename: 'pip.styles.css' }),
      new HtmlWebpackPlugin({
        template: './src/index.html',
        filename: 'index.html',
        inject: 'body'
      })
    ],
    devtool: isProd ? false : 'eval-source-map',
    performance: { hints: false }
  };
};
