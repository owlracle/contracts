const { ethers } = require("hardhat");

module.exports = async (network) => {
    const result = {};
    if (network == 'sepolia') {
        result.initialLiquidityETH = '0.01';
        result.uniswapV2RouterAddress = '0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008';
        result.uniswapV2FactoryAddress = '0x7E0987E5b3a30e3f2828572Bb659A548460a3003';
    }
    else {
        result.initialLiquidityETH = '1';
        result.uniswapV2RouterAddress = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
        result.uniswapV2FactoryAddress = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';    
    }
    
    // deploy token

    const [ deployer, user1 ] = await ethers.getSigners();
    console.log(`Deploying contracts with ${ deployer.address }`);

    let eth = await deployer.getBalance();

    const OwlToken = await ethers.getContractFactory("OwlToken");
    const owlToken = await OwlToken.deploy();
    await owlToken.deployed();

    console.log(`OwlToken address: ${ owlToken.address }`);

    let diff = eth.sub(await deployer.getBalance());
    console.log(`Deploy cost: ${ ethers.utils.formatEther(diff) } ETH`);
    
    return {
        ...result,
        deployer,
        user1,
        owlToken,
    }
}