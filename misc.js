export function Time(Sec){
	if(Sec / 60 >= 1){
		var Min = parseInt((Sec / 60), 10);
		Sec %= 60;
	}
	else
		if(Sec == Math.round(Sec))
			return `${parseFloat(Sec)}`;
		else
			return `${parseFloat(Sec).toFixed(2)}`;

	if(Min / 60 >= 1){
		var Hr = parseInt((Min / 60), 10);
		Min %= 60;
	}
	else
		if(Sec == Math.round(Sec))
			return `${Min}:${parseFloat(Sec)}`;
		else
			return `${Min}:${parseFloat(Sec).toFixed(2)}`;

	if(Sec == Math.round(Sec))
		return `${Hr}:${Min}:${parseFloat(Sec)}`;
	else	
		return `${Hr}:${Min}:${parseFloat(Sec).toFixed(2)}`;
}
