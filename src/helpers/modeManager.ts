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
