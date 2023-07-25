module.exports = async ({
    owlToken,
    uniswapV2Router,
    user1,
    deployer: owner,
}) => {
    let amountSwap = ethers.utils.parseEther('0.03');

    console.log('Swap in is starting...');

    await uniswapV2Router.connect(user1).swapExactETHForTokensSupportingFeeOnTransferTokens(
        0,
        [ uniswapV2Router.WETH(), owlToken.address ],
        user1.address,
        Date.now() + 1000 * 60 * 10,
        { value: amountSwap }
    );

    const balance = await owlToken.balanceOf(user1.address);
    console.log(`User balance: ${ethers.utils.formatEther(balance)}. Amount swap: ${ethers.utils.formatEther(amountSwap)}`);

    // owner balance
    let ownerBalance = await owlToken.balanceOf(owner.address);
    console.log(`Owner balance: ${ethers.utils.formatEther(ownerBalance)}`);

    // total supply
    let totalSupply = await owlToken.totalSupply();
    console.log(`Total supply: ${ethers.utils.formatEther(totalSupply)}`);

    
    amountSwap = await owlToken.balanceOf(user1.address);

    // perform the swap
    console.log('Swap out is starting...');

    await owlToken.connect(user1).approve(uniswapV2Router.address, amountSwap);
    await uniswapV2Router.connect(user1).swapExactTokensForETHSupportingFeeOnTransferTokens(
        amountSwap,
        0,
        [ owlToken.address, uniswapV2Router.WETH() ],
        user1.address,
        Date.now() + 1000 * 60 * 10,
    );

    const balanceETH = await ethers.provider.getBalance(user1.address);
    const balanceToken = await owlToken.balanceOf(user1.address);
    console.log(`User balance ETH: ${ethers.utils.formatEther(balanceETH)}. Balance token: ${ethers.utils.formatEther(balanceToken)}`);

    // owner balance
    ownerBalance = await owlToken.balanceOf(owner.address);
    console.log(`Owner balance: ${ethers.utils.formatEther(ownerBalance)}`);

    // total supply
    totalSupply = await owlToken.totalSupply();
    console.log(`Total supply: ${ethers.utils.formatEther(totalSupply)}`);
}