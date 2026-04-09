import handler from './api/finance/market.js';
const req = { method: 'GET' };
const res = {
  setHeader: () => {},
  status: (code) => ({
    json: (data) => console.log(JSON.stringify(data, null, 2))
  })
};
handler(req, res);
