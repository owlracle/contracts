const { ethers } = require("hardhat");

module.exports = async ({
    uniswapV2RouterAddress,
    uniswapV2FactoryAddress,
    initialLiquidityETH,
    deployer,
    owlToken
}) => {
    let eth = await deployer.getBalance();

    let uniswapV2Router = await ethers.getContractAt('contracts/MockUniswapV2.sol:IUniswapV2Router02', uniswapV2RouterAddress);
    let uniswapV2Factory = await ethers.getContractAt('contracts/MockUniswapV2.sol:IUniswapV2Factory', uniswapV2FactoryAddress);

    console.log('Creating pair...')
    await uniswapV2Factory.createPair(owlToken.address, uniswapV2Router.WETH());

    let amountToken = (await owlToken.balanceOf(deployer.address)).div(2);
    let amountETH = ethers.utils.parseEther(initialLiquidityETH);

    console.log('Adding liquidity...')
    await owlToken.approve(uniswapV2RouterAddress, amountToken);
    const liquidity = await uniswapV2Router.addLiquidityETH(
        owlToken.address,
        amountToken,
        0,
        0,
        deployer.address,
        Date.now() + 1000 * 60 * 10,
        { value: amountETH }
    );

    // wait for the transaction to be mined
    await liquidity.wait();
    
    const pairAddress = await uniswapV2Factory.getPair(owlToken.address, uniswapV2Router.WETH());
    let uniswapV2Pair = await ethers.getContractAt('contracts/MockUniswapV2.sol:IUniswapV2Pair', pairAddress);
    console.log(`UniswapV2Pair address: ${ uniswapV2Pair.address }`);

    console.log('Exclude pair from fee...');
    await owlToken.excludeFromMaxWalletSize(uniswapV2Pair.address);

    let diff = eth.sub(await deployer.getBalance());
    console.log(`Spent ${ ethers.utils.formatEther(diff) } ETH`);

    return {
        uniswapV2Router,
    }
}