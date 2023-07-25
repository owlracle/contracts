let returnedVars = {};

const scripts = ([
    'OwlToken',
    'ClaimOwl',
]).map(e => require(`./${e}`));