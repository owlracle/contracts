const hre = require("hardhat");

async function main() {
  const [ deployer ] = await hre.ethers.getSigners();
  console.log(`Deploying contracts with ${ deployer.address }`);

  const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
  const mockDai = await MockERC20.deploy("MockDai", "mDAI");
  console.log(`MockDai address: ${ mockDai.address }`);

  const OwlToken = await hre.ethers.getContractFactory("OwlToken");
  const owlToken = await OwlToken.deploy();
  console.log(`OwlToken address: ${ owlToken.address }`);

  const OwlFarm = await hre.ethers.getContractFactory("OwlFarm");
  const owlFarm = await OwlFarm.deploy(mockDai.address, owlToken.address, 5e11);
  console.log(`OwlFarm address: ${ owlFarm.address }`)

  await owlToken.transferOwnership(owlFarm.address);
  console.log(`OwlToken ownership transferred to ${ owlFarm.address }`)
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
