require("@nomicfoundation/hardhat-toolbox");

const networks = {};
// Set ROBINHOOD_RPC_URL and DEPLOYER_KEY in your shell to deploy; never commit them.
if (process.env.ROBINHOOD_RPC_URL && process.env.DEPLOYER_KEY) {
  networks.robinhood = {
    url: process.env.ROBINHOOD_RPC_URL,
    accounts: [process.env.DEPLOYER_KEY],
  };
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks,
  mocha: { timeout: 300000 },
};
