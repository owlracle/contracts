const fs = require('fs');

async function callback() {
    const outputFormat = 'json'; // json or txt

    const OwlToken = await ethers.getContractFactory('OwlToken');
    let owlToken = await OwlToken.deploy();

    let holders = [];
    const toHolders = 50;

    // pick file and build holders array
    const file = fs.readFileSync(__dirname + '/../files/snapshot-filtered.txt', 'utf8');
    holders = file.split('\n').map(row => {
        const [ address, balance ] = row.replace('\r', '').split(',');
        return {
            address,
            balance: ethers.utils.parseEther(balance),
        };
    });

    // Here is to shape airdrop.txt to airdrop_new.txt (list of holders with their new tokens)

    // total new tokens being distributed to holders
    const totalAirdrop = (await owlToken.totalSupply()).mul(ethers.utils.parseEther(toHolders.toString())).div(ethers.utils.parseEther('100'));

    // total old tokens held by holders
    const holdersTotal = holders.reduce((p,c) => p.add(c.balance), ethers.BigNumber.from(0));

    console.log('Total airdrop (new tokens)', ethers.utils.formatEther(totalAirdrop));
    console.log('Total amount from holders (old token)', ethers.utils.formatEther(holdersTotal));

    // amount of new tokens per old token
    const base = ethers.utils.parseEther('1000000');
    const amountPerToken = totalAirdrop.mul(base).div(holdersTotal);

    console.log('Amount per token (new/old)', parseFloat(ethers.utils.formatEther(amountPerToken)) / parseFloat(ethers.utils.formatEther(base)));

    holders.forEach(holder => {
        holder.amount = holder.balance.mul(amountPerToken).div(base);
        // holder.amount = ethers.utils.parseEther(holder.amount.toString());
    });

    // check sum of all new tokens airdropped
    const totalAirdrop2 = holders.reduce((p,c) => p.add(c.amount), ethers.BigNumber.from(0));
    console.log('Total airdrop: check sum', ethers.utils.formatEther(totalAirdrop2));

    // write airdrop.txt
    if (outputFormat === 'txt') {
        fs.writeFileSync(__dirname + '/airdrop.txt', holders.map(h => `${ h.address },${ h.amount.toString().replace('.0', '') }`).join('\n'));
    }
    // write airdrop.json
    else if (outputFormat === 'json') {
        holders = holders.map(h => ({ address: h.address, amount: h.amount.toString().replace('.0', '') }));
        fs.writeFileSync(__dirname + '/airdrop.json', JSON.stringify(holders, null, 2));
    }
    else {
        console.log('Invalid output format. Exiting...');
        return;
    }
    
}

module.exports = {
    name: 'token-distribution',
    description: 'Create airdrop.txt file with new tokens distribution.',
    callback,
};