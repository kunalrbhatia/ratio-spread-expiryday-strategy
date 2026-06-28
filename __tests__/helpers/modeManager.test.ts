import { jest } from '@jest/globals';
import { isPaperMode, setPaperMode } from '../../src/helpers/modeManager.js';
import fs from 'fs';

describe('modeManager helper', () => {
  let existsSpy: any;
  let writeSpy: any;
  let unlinkSpy: any;

  beforeEach(() => {
    existsSpy = jest.spyOn(fs, 'existsSync').mockImplementation(() => false);
    writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
    unlinkSpy = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
  });

  afterEach(() => {
    existsSpy.mockRestore();
    writeSpy.mockRestore();
    unlinkSpy.mockRestore();
  });

  it('should return correct paper mode based on file existence', () => {
    existsSpy.mockReturnValueOnce(true);
    expect(isPaperMode()).toBe(true);

    existsSpy.mockReturnValueOnce(false);
    expect(isPaperMode()).toBe(false);
  });

  it('should write/unlink paper file correctly', () => {
    setPaperMode(true);
    expect(writeSpy).toHaveBeenCalled();

    existsSpy.mockReturnValueOnce(true);
    setPaperMode(false);
    expect(unlinkSpy).toHaveBeenCalled();
  });
});
