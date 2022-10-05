const { ethers } = require("hardhat");
require('dotenv').config();

async function main() {
    const [ user ] = await ethers.getSigners();
    console.log(`I am ${ user.address }`);

    const farmAddress = process.env.GOERLI_FARM_ADDRESS;
    const owlAddress = process.env.GOERLI_OWL_ADDRESS;
    const lpAddress = process.env.GOERLI_LP_ADDRESS;

    const owlFarm = await ethers.getContractAt("OwlFarm", farmAddress);
    const owlToken = await ethers.getContractAt("OwlToken", owlAddress);
    const owlLp = await ethers.getContractAt("MockERC20", lpAddress);

    const OWLBalance = await owlToken.balanceOf(user.address);
    console.log('OWL balance: ', ethers.utils.formatEther(OWLBalance));

    const lpBalance = await owlLp.balanceOf(user.address);
    console.log('Untaked LP balance: ', ethers.utils.formatEther(lpBalance));

    const stakingBalance = await owlFarm.stakingBalance(user.address);
    console.log('Staked balance: ', ethers.utils.formatEther(stakingBalance));

    const rewards = await owlFarm.calculateYieldTotal(user.address);
    console.log('Rewards ready to be taken: ', ethers.utils.formatEther(rewards));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
