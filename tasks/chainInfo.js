const { task } = require("hardhat/config");

task("chainInfo", "Prints the current block number and chain ID")
  .setAction(async (taskArgs, hre) => {
    const blockNumber = await hre.ethers.provider.getBlockNumber();
    const network = await hre.ethers.provider.getNetwork();
    console.log(`Chain ID: ${network.chainId}`);
    console.log(`Current Block Number: ${blockNumber}`);
  });

task("accounts", "Prints the list of accounts and their balances")
  .setAction(async (taskArgs, hre) => {
    const accounts = await hre.ethers.getSigners();
    for (const account of accounts) {
      const balance = await hre.ethers.provider.getBalance(account.address);
      console.log(`${account.address}: ${hre.ethers.formatEther(balance)} ETH`);
    }
  });
