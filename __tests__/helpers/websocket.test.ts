import { jest } from '@jest/globals';
import fs from 'fs';

// Define the mock ws
const mockOn = jest.fn();
const mockSend = jest.fn();
const mockClose = jest.fn();
const mockRemoveAllListeners = jest.fn();

jest.unstable_mockModule('ws', () => {
  const mockWs = jest.fn().mockImplementation(() => {
    return {
      on: mockOn,
      send: mockSend,
      close: mockClose,
      removeAllListeners: mockRemoveAllListeners,
    };
  });
  return {
    default: mockWs,
    WebSocket: mockWs,
  };
});

// Dynamic imports to ensure mock is registered first
const { smartStream } = await import('../../src/helpers/websocket.js');
const { sessionStore } = await import('../../src/store/sessionStore.js');

describe('smartStream binary parser', () => {
  let existsSpy: any;

  beforeEach(() => {
    jest.clearAllMocks();
    existsSpy = jest.spyOn(fs, 'existsSync').mockImplementation((path: any) => {
      if (typeof path === 'string' && path.endsWith('.paper')) {
        return false;
      }
      return false;
    });
  });

  afterEach(() => {
    existsSpy.mockRestore();
  });

  it('should parse binary tick correctly with the new offsets', (done) => {
    jest.spyOn(sessionStore, 'getSession').mockReturnValue({
      jwtToken: 'mock-jwt',
      feedToken: 'mock-feed',
    });

    let messageHandler: ((data: any) => void) | null = null;

    mockOn.mockImplementation((event: string, callback: any) => {
      if (event === 'message') {
        messageHandler = callback;
      }
      // Return mock object to allow chaining if any
      return {
        on: mockOn,
      };
    });

    smartStream.connect((tick) => {
      try {
        expect(tick.token).toBe('223344');
        expect(tick.ltp).toBe(1234.56);
        done();
      } catch (err) {
        done(err);
      }
    });

    // Create a mock buffer representing the Angel One binary feed
    // Size: 43 bytes + 8 bytes (ltp) = 51 bytes
    const buffer = Buffer.alloc(51);
    
    // byte 0 = subscription mode (e.g. 1)
    buffer.writeUInt8(1, 0);
    // byte 1 = exchange type (e.g. 1)
    buffer.writeUInt8(1, 1);
    
    // bytes 2-26 = the 25-byte token (e.g. "223344")
    const tokenStr = '223344';
    buffer.write(tokenStr, 2, 'utf8');
    
    // bytes 27-34 = sequence number (8 bytes)
    // bytes 35-42 = exchange timestamp (8 bytes)
    
    // bytes 43-50 = LTP (8-byte long, in paise: 1234.56 * 100 = 123456)
    buffer.writeBigInt64LE(123456n, 43);

    // Call the message handler
    if (messageHandler) {
      (messageHandler as any)(buffer);
    } else {
      done(new Error('Message handler was not registered'));
    }
  });
});
