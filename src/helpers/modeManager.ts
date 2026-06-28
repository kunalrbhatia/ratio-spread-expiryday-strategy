import fs from 'fs';
import path from 'path';

const paperFilePath = path.join(process.cwd(), '.paper');

export const isPaperMode = (): boolean => {
  return fs.existsSync(paperFilePath);
};

export const setPaperMode = (on: boolean): void => {
  if (on) {
    fs.writeFileSync(paperFilePath, 'PAPER', 'utf-8');
  } else {
    if (fs.existsSync(paperFilePath)) {
      fs.unlinkSync(paperFilePath);
    }
  }
};

const killFilePath = path.join(process.cwd(), '.kill');

export const isKillSwitchActive = (): boolean => {
  return fs.existsSync(killFilePath);
};

export const setKillSwitch = (on: boolean): void => {
  if (on) {
    fs.writeFileSync(killFilePath, 'KILL', 'utf-8');
  } else {
    if (fs.existsSync(killFilePath)) {
      fs.unlinkSync(killFilePath);
    }
  }
};
