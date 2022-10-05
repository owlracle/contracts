const { ethers } = require("hardhat");
require('dotenv').config();

async function main() {
    const [ user ] = await ethers.getSigners();
    console.log(`I am ${ user.address }`);

    const farmAddress = process.env.GOERLI_FARM_ADDRESS;
    const lpAddress = process.env.GOERLI_LP_ADDRESS;

    const owlFarm = await ethers.getContractAt("OwlFarm", farmAddress);
    const owlLp = await ethers.getContractAt("MockERC20", lpAddress);

    const lpBalance = await owlLp.balanceOf(user.address);
    await owlLp.connect(user).approve(owlFarm.address, lpBalance);
    await owlFarm.connect(user).stake(lpBalance);

    console.log('Staked balance: ', ethers.utils.formatEther(lpBalance));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
