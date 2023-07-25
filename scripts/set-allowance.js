async function main() {
    let airDropContractAddress = '0xfbdEe1B7B115e555f192bb8B8bd696caFD6bf1Ae';
    let owlToken = await ethers.getContractAt('OwlToken', '0x4E91A95E11b3c640E4414Ca7Aa0F58F9797715A7');
    let totalSupply = await owlToken.totalSupply();
    let amountToApprove = totalSupply.div(2);
    await owlToken.approve(airDropContractAddress, amountToApprove);

    console.log(await owlToken.totalSupply());
}
main().then(() => process.exit(0)).catch(error => {
    console.error(error);
    process.exit(1);
});