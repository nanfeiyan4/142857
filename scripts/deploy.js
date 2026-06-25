const hre = require("hardhat");

async function main() {
  console.log("Deploying Crowdfunding contract...");

  // Get the contract factory
  const Crowdfunding = await hre.ethers.getContractFactory("Crowdfunding");

  // Deploy the contract
  const crowdfunding = await Crowdfunding.deploy();
  await crowdfunding.waitForDeployment();

  const address = await crowdfunding.getAddress();
  console.log("Crowdfunding contract deployed to:", address);

  // Log deployment info for frontend
  console.log("\n========================================");
  console.log("Deployment Info (copy to app.js):");
  console.log("Contract Address:", address);
  console.log("========================================");

  // Get and display network info
  const network = await hre.ethers.provider.getNetwork();
  console.log(`\nNetwork Chain ID: ${network.chainId}`);

  // List accounts
  const accounts = await hre.ethers.getSigners();
  console.log("\nAvailable Accounts:");
  for (const account of accounts) {
    const balance = await hre.ethers.provider.getBalance(account.address);
    console.log(`  ${account.address}: ${hre.ethers.formatEther(balance)} ETH`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
