const { ethers } = require("hardhat");
require('dotenv').config();

async function main() {
    const [ user ] = await ethers.getSigners();
    console.log(`I am ${ user.address }`);

    const farmAddress = process.env.GOERLI_FARM_ADDRESS;

    const owlFarm = await ethers.getContractAt("OwlFarm", farmAddress);

    const lpBalance = await owlFarm.stakingBalance(user.address);
    await owlFarm.connect(user).unstake(lpBalance);

    console.log('Unstaked: ', ethers.utils.formatEther(lpBalance));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
