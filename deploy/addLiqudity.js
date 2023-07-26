const { ethers } = require("hardhat");

module.exports = async ({
    deployer,
    owlToken
}) => {
    // // sepolia address
    // const uniswapV2RouterAddress = '0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008';
    // const uniswapV2FactoryAddress = '0x7E0987E5b3a30e3f2828572Bb659A548460a3003';

    // mainnet address
    const uniswapV2RouterAddress = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';
    const uniswapV2FactoryAddress = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';

    let uniswapV2Router = await ethers.getContractAt('contracts/MockUniswapV2.sol:IUniswapV2Router02', uniswapV2RouterAddress);
    let uniswapV2Factory = await ethers.getContractAt('contracts/MockUniswapV2.sol:IUniswapV2Factory', uniswapV2FactoryAddress);

    await uniswapV2Factory.createPair(owlToken.address, uniswapV2Router.WETH());

    let amountToken = (await owlToken.balanceOf(deployer.address)).div(2);
    let amountETH = ethers.utils.parseEther('1');

    console.log('Adding liquidity...')
    await owlToken.approve(uniswapV2RouterAddress, amountToken);
    await uniswapV2Router.addLiquidityETH(
        owlToken.address,
        amountToken,
        0,
        0,
        deployer.address,
        Date.now() + 1000 * 60 * 10,
        { value: amountETH }
    );

    const pairAddress = await uniswapV2Factory.getPair(owlToken.address, uniswapV2Router.WETH());
    uniswapV2Pair = await ethers.getContractAt('contracts/MockUniswapV2.sol:IUniswapV2Pair', pairAddress);
    console.log(`UniswapV2Pair address: ${ uniswapV2Pair.address }`);

    await owlToken.excludeFromMaxWalletSize(uniswapV2Pair.address);

    return {
        uniswapV2Router,
    }
}