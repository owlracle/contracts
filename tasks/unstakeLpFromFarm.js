const callback = async (args, { ethers }) => {
    const [ user ] = await ethers.getSigners();
    console.log(`I am ${ user.address }`);

    const farmAddress = process.env.GOERLI_FARM_ADDRESS;

    const owlFarm = await ethers.getContractAt("OwlFarm", farmAddress);

    const lpBalance = await owlFarm.stakingBalance(user.address);
    await owlFarm.connect(user).unstake(lpBalance);

    console.log('Unstaked: ', ethers.utils.formatEther(lpBalance));
}

module.exports = {
    name: 'unstake',
    description: 'Unstake LP from farm.',
    callback: callback,
};