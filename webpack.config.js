const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

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
      runtimeChunk: false
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
