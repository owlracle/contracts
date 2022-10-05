const callback = async (args, { ethers }) => {
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
};

module.exports = {
    name: 'stake',
    description: 'Stake LP into farm.',
    callback: callback,
};