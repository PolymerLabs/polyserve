/**
 * @license
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as fs from 'mz/fs';
import * as path from 'path';
import * as pem from 'pem';
import * as sinon from 'sinon';
import * as http from 'spdy';
import * as supertest from 'supertest-as-promised';
import * as tmp from 'tmp';

import {getApp, ServerOptions} from '../start_server';
import {startServer, startServers} from '../start_server';


chai.use(chaiAsPromised);
const assert = chai.assert;

const root = path.join(__dirname, '..', '..', 'test');

suite('startServer', () => {

  test('returns an app', () => {
    const app = getApp({});
    assert.isOk(app);
  });

  test('serves root application files', async() => {
    const app = getApp({root});
    await supertest(app).get('/test-file.txt').expect(200, 'PASS\n');
  });

  test('serves component files', async() => {
    const app = getApp({root});
    await supertest(app)
        .get('/bower_components/test-component/test-file.txt')
        .expect(200, 'TEST COMPONENT\n');
  });


  test('serves index.html, not 404', async() => {
    const app = getApp({root});
    await supertest(app).get('/foo').expect(200, 'INDEX\n');
  });

  ['html', 'js', 'json', 'css', 'png', 'jpg', 'jpeg', 'gif'].forEach(
      (ext) => {test(`404s ${ext} files`, async() => {
        const app = getApp({root});

        await supertest(app).get('/foo.' + ext).expect(404);
      })});

  suite('h2', () => {
    let _certFile: tmp.SynchrounousResult;
    let _keyFile: tmp.SynchrounousResult;
    let _nodeVersion: number;
    let _serverOptions: ServerOptions;
    let _stubServer: http.server.Server;

    _setupNodeVersion();

    suiteSetup(() => {
      _setupServerOptions();
      _setupStubServer();
    });

    suiteTeardown(() => {
      _teardownStubServer();
    });

    test('rejects unsupported Node version (< 5) only', function() {
      if (_nodeVersion < 5) {
        return assert.isRejected(startServer(_serverOptions));
      } else {
        return assert.becomes(_startStubServer(_serverOptions), _stubServer);
      }
    });

    // Only run h2 tests for Node versions that support ALPN
    const suiteDef = (_nodeVersion < 5) ? suite.skip : suite;
    suiteDef('node5+', () => {
      setup(() => {
        _setupServerOptions();
      });

      test('generates new TLS cert/key if unspecified', async() => {
        const createCertSpy = sinon.spy(pem, 'createCertificate');

        // reset paths to key/cert files so that default paths are used
        _serverOptions.keyPath = undefined;
        _serverOptions.certPath = undefined;

        const certFilePath = 'cert.pem';
        const keyFilePath = 'key.pem';
        _deleteFiles([certFilePath, keyFilePath]);

        try {
          const server = await _startStubServer(_serverOptions)
          assert.isOk(server);
          await sinon.assert.calledOnce(createCertSpy);
          await Promise.all([
            fs.readFile(certFilePath)
                .then(buf => _assertValidCert(buf.toString())),
            fs.readFile(keyFilePath)
                .then(buf => _assertValidKey(buf.toString()))
          ]);
          await _deleteFiles([certFilePath, keyFilePath]);
          await new Promise((resolve) => server.close(resolve));
        } finally {
          createCertSpy.restore();
        }
      });

      test('generates new TLS cert/key if specified files blank', async() => {
        const createCertSpy = sinon.spy(pem, 'createCertificate');

        try {
          const server = await _startStubServer(_serverOptions);
          assert.isOk(server);
          await sinon.assert.calledOnce(createCertSpy);
          await Promise.all([
            // _certFile and _keyFile point to newly created (blank) temp
            // files
            fs.readFile(_certFile.name)
                .then(buf => _assertValidCert(buf.toString())),
            fs.readFile(_keyFile.name)
                .then(buf => _assertValidKey(buf.toString()))
          ]);
          await new Promise((resolve) => server.close(resolve));
        } finally {
          createCertSpy.restore();
        }
      });

      test('reuses TLS cert/key', async() => {
        _serverOptions.keyPath = path.join(root, 'key.pem');
        _serverOptions.certPath = path.join(root, 'cert.pem');

        const createCertSpy = sinon.spy(pem, 'createCertificate');


        try {
          let error: any;
          const server = await _startStubServer(_serverOptions);
          assert.isOk(server);
          await sinon.assert.notCalled(createCertSpy);
          await new Promise((resolve) => server.close(resolve));
        } finally {
          createCertSpy.restore();
        }
      });

      test('throws error for blank h2-push manifest', () => {
        const dummyFile = tmp.fileSync();
        _serverOptions.pushManifestPath = dummyFile.name;
        assert.throws(() => getApp(_serverOptions));
      });

      test.skip(
          'pushes only files specified in manifest',
          () => {
              // TODO: Implement
          });

      test.skip(
          'pushes only files specified in link-preload header',
          () => {
              // TODO: Implement
          });

      test.skip(
          'does not push files specified as nopush in link-preload header',
          () => {
              // TODO: Implement
          });

      test.skip(
          'rejects nonexistent file in manifest',
          () => {
              // TODO: Implement
          });

      test.skip(
          'accepts root path in manifest',
          () => {
              // TODO: Implement
          });
    });

    function _setupServerOptions() {
      _keyFile = tmp.fileSync();
      _certFile = tmp.fileSync();
      _serverOptions = {
        root,
        protocol: 'h2',
        keyPath: _keyFile.name,
        certPath: _certFile.name
      };
    }

    function _setupNodeVersion() {
      const matches = /(\d+)\./.exec(process.version);
      if (matches) {
        _nodeVersion = Number(matches[1]);
      }
    }

    let createServerStub: sinon.SinonStub;
    function _setupStubServer() {
      _stubServer =
          sinon.createStubInstance(http['Server']) as any as http.Server;
      createServerStub = sinon.stub(http, 'createServer').returns(_stubServer);
      _stubServer.close = (cb) => cb.call(_stubServer);
    }

    function _teardownStubServer() {
      createServerStub.restore();
    }

    async function _startStubServer(options: ServerOptions) {
      return new Promise<http.server.Server>(resolve => {
        _stubServer.listen = (() => resolve(_stubServer)) as any;
        startServer(options);
      });
    }

    function _assertValidCert(cert: string) {
      return new Promise((resolve, reject) => {
        if (!cert) {
          reject(new Error('invalid cert'));
        } else {
          pem.readCertificateInfo(cert, (err: any) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        }
      });
    }

    function _assertValidKey(key: string) {
      return new Promise((resolve, reject) => {
        if (/BEGIN[^]+?KEY[^]+END[^]+?KEY/.test(key)) {
          resolve();
        } else {
          reject(new Error('invalid key'));
        }
      });
    }

    function _deleteFiles(files: string[]) {
      for (const file of files) {
        try {
          fs.unlinkSync(file);
        } catch (e) {
          // ignore
        }
      }
    }
  });
});

suite('startServers', () => {
  suite('variants', () => {
    const variantsRoot = path.join(root, 'variants');

    let prevCwd: string;
    setup(() => {
      prevCwd = process.cwd();
      process.chdir(variantsRoot);
    });

    teardown(() => {
      process.chdir(prevCwd);
    });

    test('serves files out of a given components directory', async() => {
      const servers = await startServers({});

      assert.deepEqual(
          servers.map(s => s.kind).sort(),
          ['control', 'mainline', 'variant', 'variant'].sort());

      const mainlineServer = servers.find(s => s.kind === 'mainline');
      await supertest(mainlineServer.server)
          .get('/components/contents.txt')
          .expect(200, 'mainline\n');

      const fooServer =
          servers.find(s => s.kind === 'variant' && s.variantName === 'foo');
      await supertest(fooServer.server)
          .get('/components/contents.txt')
          .expect(200, 'foo\n');

      const barServer =
          servers.find(s => s.kind === 'variant' && s.variantName === 'bar');
      await supertest(barServer.server)
          .get('/components/contents.txt')
          .expect(200, 'bar\n');

      const dispatchServer = servers.find(s => s.kind === 'control');
      const dispatchTester = supertest(dispatchServer.server);
      const apiResponse =
          await dispatchTester.get('/api/serverInfo').expect(200);
      assert.deepEqual(JSON.parse(apiResponse.text), {
        packageName: 'variants-test',
        mainlineServer: {port: mainlineServer.server.address().port},
        variants: [
          {name: 'bar', port: barServer.server.address().port},
          {name: 'foo', port: fooServer.server.address().port}
        ]
      });
      const pageResponse = await dispatchTester.get('/').expect(200);
      // Assert that some polyserve html is served.
      assert.match(pageResponse.text, /<html>/);
      assert.match(pageResponse.text, /Polyserve/);
    });
  });
})
