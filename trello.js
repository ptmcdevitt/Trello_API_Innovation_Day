// JavaScript Document
 var trelloSuccess = function () {
    console.log("Trello Success");
};
var trelloError = function (response) {
    console.log("Trello Error: " + response.responseText);
};
function onTrelloErrorReject(deferred) {
    return function (response) {
        deferred.reject("Trello Error: " + response.responseText);
    };
}
