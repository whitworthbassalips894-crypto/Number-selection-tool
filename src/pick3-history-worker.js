import { replayPick3 } from './pick3-history.js';

self.onmessage = ({ data }) => {
  try {
    const { draws, requestId } = data;
    const rows = [];
    for (let i = 0; i < draws.length; i++) {
      rows.push(replayPick3(draws, draws[i]));
      if ((i + 1) % 20 === 0 || i + 1 === draws.length) {
        self.postMessage({ requestId, rows: rows.splice(0), done: i + 1, total: draws.length });
      }
    }
  } catch (error) {
    self.postMessage({ requestId: data.requestId, error: String(error?.message || error) });
  }
};
