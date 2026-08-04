const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';

  return {
    entry: './src/index.js',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'pip.bundle.js',
      // Relative publicPath so index.html works opened directly via file://
      publicPath: ''
    },
    // No runtime code-splitting: this app is opened via file:// (no server),
    // and dynamic import()/chunk fetches are unreliable under the file: protocol.
    // "Code splitting" here means modular SOURCE files bundled into one output.
    optimization: {
      splitChunks: false,
      runtimeChunk: false
    },
    experiments: {
      asyncWebAssembly: false
    },
    module: {
      rules: [
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, 'css-loader']
        },
        {
          // sql.js's wasm binary + pixel fonts are inlined as base64 data URIs
          // so nothing ever needs a runtime fetch()/XHR to a local file — Chrome
          // blocks those under file://, but data: URIs and <script>/<link> tags
          // load fine.
          test: /\.wasm$/,
          type: 'asset/inline'
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
    devServer: {
      static: path.resolve(__dirname, 'dist'),
      open: true
    },
    devtool: isProd ? false : 'eval-source-map',
    performance: { hints: false }
  };
};
