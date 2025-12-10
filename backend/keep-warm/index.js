module.exports = async function (context, myTimer) {
    context.log('Keep-warm ping at:', new Date().toISOString());
};
